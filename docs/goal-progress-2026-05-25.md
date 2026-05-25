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
- Latest commit: `67fb1f7 fix(config): require safer mainnet signing keys`
- Main hardening commit: `f6a2b65 feat(mcp): harden agent payment safety`
- Report commit: `ceb2f4e docs: add goal progress report`
- Remote: pushed to `origin/feat/mcp-0.1.3-hardening`
- PR URL: `https://github.com/MorganOnCode/cardano402/pull/new/feat/mcp-0.1.3-hardening`

Current local status: clean working tree on `feat/mcp-0.1.3-hardening`,
tracking `origin/feat/mcp-0.1.3-hardening`.

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
  - trusting `payload.accepted` for server-owned price fields,
  - examples encouraging unsafe hot seed handling.

### Dependency and audit posture

- CI dependency audit now runs as `pnpm audit --prod --audit-level=moderate`.
- Added a pnpm override for the vulnerable transitive `ip-address` dependency
  path under the Cardano SDK dependency.
- `pnpm audit --prod` currently reports no known vulnerabilities.

### Root facilitator signing-key hardening

- Added `chain.facilitator.seedPhraseFile`.
- Added `chain.facilitator.privateKeyFile`.
- Enforced restrictive POSIX permissions for facilitator signing-key files.
- Mainnet now rejects inline `chain.facilitator.seedPhrase` /
  `chain.facilitator.privateKey` in `config.json` unless
  `CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY=true` is explicitly set.
- Updated `config/config.example.json` and deployment docs to prefer
  file-based facilitator signing material.

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
- The monitor checks `/.well-known/x402.json`, `/supported`, `/verify`, and
  `/settle` and fails on Cloudflare challenges, HTML responses, or unexpected
  statuses.
- Added a Cloudflare WAF/runbook section to `docs/operations.md` describing
  which machine routes must skip browser challenges and which compensating
  rate limits/logging should remain.

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
- `pnpm test tests/unit/sdk/payment-gate.test.ts tests/integration/server.test.ts -- --runInBand`
- `pnpm security:payments`
- `pnpm audit --prod`
- `pnpm monitor:protocol -- --base-url <local-json-mock> --json`
- protected brand search - no matches

Earlier full-suite verification after the same hardening line:

- `pnpm test -- --runInBand` - 462 tests passed

## Remaining work

1. Apply and verify the documented Cloudflare WAF skip/rate-limit rules on
   the live zone. The runbook and monitor now exist; the external Cloudflare
   state still needs to be changed.
2. Remote signer / external policy signer design for Mainnet. File-based keys
   are now enforced for Mainnet by default, but a remote/policy signer is still
   the stronger long-term boundary.
3. Deployment runbook hardening for confirmation depth, Blockfrost quota,
   rate-limit tuning, and incident response.
4. Optional Semgrep rules for richer AST-aware payment anti-pattern detection.
5. Branch protection review to require CodeQL, OSV, Gitleaks, Zizmor,
   dependency review, payment invariant checks, tests, and audit before merge.

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
