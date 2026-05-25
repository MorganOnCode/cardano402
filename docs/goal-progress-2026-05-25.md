# Goal Progress Report - 2026-05-25

## Original goal prompt

> check this codebase for /opt/cardano402 and github/MorganOnCode/cardano402 and cardano402.com - ensure we're completely secure when offering a financial tool for people's agents to handle money. its open source to reduce risk and defer to installers. i want deep analysis of what the function is, compared to https://github.com/x402-foundation/x402 specs. Check for any bugs or exploits, use and recommend tools (inc paid) like sentry, greptile, audit tools etc.

## Are we still on track?

Yes. The work remains directly aligned with the goal:

- It reviews the local codebase and live `cardano402.com` behavior.
- It compares the implementation against the x402 Cardano exact scheme.
- It hardens the highest-risk money-handling path: agent-controlled MCP
  signing.
- It adds CI checks for payment-specific regressions.
- It documents remaining production risks and recommended tools.

The goal is not complete yet. We have made concrete progress, but remaining
work includes remote signer design, live Cloudflare API accessibility, and
deeper deployment/operator hardening.

## Branch and commit

- Branch: `feat/mcp-0.1.3-hardening`
- Pull request: `https://github.com/MorganOnCode/cardano402/pull/88`
- Protocol monitor workflow commit: `91b8464 ci: add protocol monitor workflow`
- Main hardening commit: `f6a2b65 feat(mcp): harden agent payment safety`
- Report commit: `ceb2f4e docs: add goal progress report`
- Remote: pushed to `origin/feat/mcp-0.1.3-hardening`
- PR #88 title updated to `feat(mcp): harden agent payment safety and
  production posture`.

Current local status: clean working tree on `feat/mcp-0.1.3-hardening`,
tracking `origin/feat/mcp-0.1.3-hardening`.

## Pull request status

Observed on 2026-05-25 UTC for PR #88 head
`c5ce1eda16c226964da551c744e3b1adc8fbd1b0`:

- CI completed successfully.
- CI jobs succeeded: Lint & Type Check, Test, Build, Docker Build, Security
  Audit.
- CI Security Audit included Dependency audit, Payment security invariants, and
  Release readiness invariants.
- CodeQL completed successfully.
- OSV-Scanner completed successfully.
- Gitleaks completed successfully.
- Dependency Review completed successfully.
- zizmor completed successfully.

Scorecard is configured as a scheduled security workflow but was not returned
for this PR head in the workflow-run lookup. Repository branch protection still
needs admin-side enforcement of the documented required checks.

## In-scope changes made

### MCP agent payment safety

- Bumped `@cardano402/mcp-server` to `0.1.3`.
- Added `0.1.3` changelog entry for security hardening.
- Added `SEED_PHRASE_FILE` / `--seed-phrase-file`.
- Enforced restrictive seed file permissions on POSIX.
- Mainnet now rejects env-var seed material unless the explicit unsafe override
  is set.
- Added `CARDANO402_SPEND_STORE_PATH` / `--spend-store-path`.
- Mainnet now requires persistent spend tracking.
- Added persistent spend ledger support.
- Added pending spend reservations before signing.
- Reservations commit after successful signing and roll back on signer failure.
- Pending reservations expire after TTL.
- Persistent ledger operations use a lock to avoid concurrent signer races.
- Spend entries now include recipient, asset, transaction hash, tool name, and
  status.

### x402 and resource-server compatibility

- `createPaymentGate` now accepts both `Payment-Signature` and `X-PAYMENT`.
- CORS now allows `X-PAYMENT`.
- Added regression coverage for the `X-PAYMENT` alias.
- `createPaymentGate` now keeps the nested verify `accepted.network`
  server-owned instead of copying it from the client payment header.
- Updated core spec notes so they no longer claim the app layer lacks alias
  support.

### Payment-specific CI guardrails

- Added `scripts/payment-security-check.mjs`.
- Added `pnpm security:payments`.
- CI now runs the payment invariant check after dependency audit.
- The check guards against:
  - losing `X-PAYMENT` support,
  - losing CORS support for `X-PAYMENT`,
  - deriving `paymentRequirements` from client/request data,
  - trusting `payload.accepted` for server-owned network or price fields,
  - examples encouraging unsafe hot seed handling.

### Dependency and audit posture

- CI dependency audit now runs as `pnpm audit --prod --audit-level=moderate`.
- Added a pnpm override for the vulnerable transitive `ip-address` dependency
  path under the Cardano SDK dependency.
- `pnpm audit --prod` currently reports no known vulnerabilities.

### Root facilitator signing-key hardening

- Added `chain.facilitator.seedPhraseFile`.
- Added `chain.facilitator.privateKeyFile`.
- Added explicit `chain.facilitator.signerMode` with the current supported
  root facilitator mode, `local-file`.
- Enforced restrictive POSIX permissions for facilitator signing-key files.
- Mainnet now rejects inline `chain.facilitator.seedPhrase` /
  `chain.facilitator.privateKey` in `config.json` unless
  `CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY=true` is explicitly set.
- Updated `config/config.example.json` and deployment docs to prefer
  file-based facilitator signing material.
- Added `docs/mainnet-signer-isolation.md` to define the target remote or
  hardware-backed signer boundary and to make clear that file-backed Mainnet
  credentials remain a hot-wallet interim state.
- `/health` now exposes `policy.signer` so operators can see the current root
  facilitator signer mode and whether it is a hot-wallet posture.

### Operator-visible confirmation policy

- `/health` now exposes non-secret settlement policy under
  `policy.confirmation`.
- The payload includes network, confirmation mode, minimum confirmations,
  max timeout, and nonce requirement.
- Unit and integration tests assert the policy is present without exposing
  Blockfrost project IDs or signing material.
- `pnpm monitor:protocol` now checks `/health` for missing policy,
  `allow_mempool`, disabled nonce enforcement, low confirmation depth, and
  missing signer posture.

### Payment abuse metrics

- Added `facilitator_payment_results_total` Prometheus counter for `/verify`,
  `/settle`, and `/status`.
- Labels are limited to endpoint, result, and bounded reason so operators can
  alert on invalid request spikes, nonce lookup failures, settlement failures,
  and status polling drift without user-controlled label cardinality.

### Release readiness gate

- Added `scripts/release-readiness-check.mjs`.
- Added `pnpm security:release` and wired it into the CI security job.
- Added `docs/release-readiness.md` with local checks, required GitHub checks,
  money-handling review points, and release-note requirements.

### Documentation and review artifacts

- Added `docs/security-review-2026-05-25.md`.
- Documented:
  - system function,
  - x402 spec alignment,
  - fixed findings,
  - live-site findings,
  - remaining production risks,
  - recommended security tools.
- Updated MCP README for safer Mainnet seed handling and persistent spend store.
- Removed all local references to the protected brand name.

### Cloudflare protocol accessibility

- Added `pnpm monitor:protocol`.
- Added `scripts/protocol-monitor.mjs`.
- The monitor checks `/.well-known/x402.json`, `/health`, `/supported`,
  `/verify`, and `/settle` and fails on Cloudflare challenges, HTML responses,
  unexpected statuses, or production confirmation-policy drift.
- The manual protocol monitor workflow accepts a minimum confirmation threshold
  and passes it to `pnpm monitor:protocol`; the schedule is intentionally
  disabled until Cloudflare allows machine API routes without browser
  challenges.
- Added a Cloudflare WAF/runbook section to `docs/operations.md` describing
  which machine routes must skip browser challenges and which compensating
  rate limits/logging should remain.
- Added a manual GitHub Actions protocol monitor so the live x402 machine
  endpoints can be checked without blocking normal PR CI while the Cloudflare
  zone is still being tuned.

## Live-site findings

Observed on 2026-05-25 UTC:

- `https://cardano402.com/.well-known/x402.json` returns HTTP 200 JSON.
- `/health`, `/supported`, `/verify`, and `/settle` are Cloudflare-challenged
  for non-browser clients.

Interpretation:

- This helps reduce opportunistic abuse.
- It blocks machine clients if `cardano402.com` is intended to serve as a
  public x402 facilitator.

Recommendation:

- Keep challenge rules for human-facing pages if desired.
- Add route-specific WAF skip rules for machine API endpoints.
- Compensate with rate limits, body-size limits, telemetry, and abuse budgets.

## Verification performed

Passing checks:

- `pnpm --filter @cardano402/mcp-server test` - 102 tests passed
- `pnpm --filter @cardano402/mcp-server typecheck`
- `pnpm --filter @cardano402/mcp-server build`
- `pnpm typecheck`
- `pnpm test tests/unit/sdk/payment-gate.test.ts -- --runInBand` - 18 tests
  passed
- `pnpm test tests/unit/sdk/payment-gate.test.ts tests/integration/server.test.ts -- --runInBand`
- `pnpm security:payments`
- `pnpm audit --prod`
- `pnpm monitor:protocol -- --base-url <local-json-mock> --json`
- `pnpm monitor:protocol -- --base-url <local-json-mock> --min-confirmations 6 --json`
- protected brand search - no matches

Current live monitor status:

- On 2026-05-25 at 07:13:06 UTC, `pnpm monitor:protocol -- --base-url
  https://cardano402.com --json` failed as expected against the live site.
- `/.well-known/x402.json` returned HTTP 200 JSON.
- `/supported`, `/verify`, and `/settle` returned HTTP 403 Cloudflare
  challenge HTML with `cf-mitigated: challenge`.
- On 2026-05-25 at 07:29:35 UTC, the expanded monitor also checked `/health`
  with `--min-confirmations 6`; `/health`, `/supported`, `/verify`, and
  `/settle` returned HTTP 403 Cloudflare challenge HTML.
- This failure is useful evidence, not a repo test regression: the local
  protocol monitor smoke test passes against a JSON mock, and the live failure
  reflects external WAF behavior.

Earlier full-suite verification after the same hardening line:

- `pnpm test -- --runInBand` - 462 tests passed

## Remaining work

1. Apply and verify the documented Cloudflare WAF skip/rate-limit rules on
   the live zone. The runbook and monitor now exist; the external Cloudflare
   state still needs to be changed.
2. After the Cloudflare changes are applied, run the new protocol monitor
   workflow manually against `https://cardano402.com` and require it as an
   operational check for the live service.
3. Implement the remote signer / external policy signer design for Mainnet.
   The design target is now documented; code still uses local Lucid file-backed
   signing material for the root facilitator.
4. Deployment runbook hardening for Blockfrost quota dashboards, rate-limit
   tuning, and incident response.
5. Optional Semgrep rules for richer AST-aware payment anti-pattern detection.
6. Repository admin branch protection still needs to require the documented
   checks before merge; the in-repo release readiness gate now makes the desired
   check set explicit and CI-enforced.

## Current summary

The work is now protected on a pushed branch and is materially advancing the
goal. The highest-risk local-agent and root-facilitator hot-key paths have been
hardened, persistent spend controls have been added for MCP Mainnet usage, and
payment-specific CI invariants now guard the resource-server trust boundary.
The repo also has a written security review and this progress report.

The main unresolved operational issue is that `cardano402.com` currently
challenges machine API routes behind Cloudflare. The repo now has a monitor and
runbook for the desired posture, but the live Cloudflare zone still needs the
skip/rate-limit rules applied and verified.
