# Release Readiness Checklist

Use this checklist before merging or publishing changes that affect money
handling, x402 protocol behavior, signing, settlement, deployment, or package
release artifacts.

## Required Local Checks

Run these from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test -- --runInBand
pnpm audit --prod --audit-level=moderate
pnpm security:payments
pnpm security:release
```

If the Semgrep CLI is installed, also run the optional AST-aware payment rules:

```bash
pnpm security:semgrep
```

For MCP package releases, also run:

```bash
pnpm --filter @cardano402/mcp-server test
pnpm --filter @cardano402/mcp-server build
```

For core package releases, also run:

```bash
pnpm --filter @cardano402/core test
pnpm --filter @cardano402/core build
```

## Required GitHub Checks

Protected branches should require these checks before merge:

- CI / Lint & Type Check
- CI / Test
- CI / Build
- CI / Docker Build
- CI / Security Audit
- CodeQL
- Dependency Review
- Gitleaks
- OSV-Scanner
- Scorecard supply-chain security
- Zizmor

The Protocol Monitor should be treated as an operational gate for the live
service. It is manual-only until Cloudflare machine-route skip rules are
applied; once those rules are live, re-enable the schedule and require it to
pass against `https://cardano402.com` with the approved minimum confirmation
threshold.

## Money-Handling Review Points

Before release, verify:

- `paymentRequirements` are derived from server-owned configuration, not from
  client input.
- `X-PAYMENT` and `Payment-Signature` request headers remain accepted where
  expected.
- CORS still allows `X-PAYMENT`.
- Malformed `paymentRequirements.payTo` values return structured verification
  failures rather than public 500s.
- `/status` transaction hashes are validated as 64-character lowercase hex
  before any chain-provider lookup.
- `/files/:cid` validates content identifiers before backend lookup, so
  malformed or oversized values do not reach filesystem/IPFS storage backends.
- `/upload` enforces its intended multipart file limit explicitly instead of
  inheriting the smaller global JSON body limit or storing oversized files.
- Settlement dedup records fail closed and structured when Redis contains
  corrupt JSON or malformed transaction hashes.
- Public `paymentRequirements.amount` values are bounded before route-level
  `BigInt` conversion.
- `/health` exposes non-secret `policy.confirmation` and `policy.signer`.
- `pnpm monitor:protocol -- --base-url https://cardano402.com --min-confirmations 6 --json`
  passes after Cloudflare machine-route rules are applied.
- `facilitator_payment_results_total` is scraped and alerting on invalid
  request spikes, nonce lookup failures, settlement failures, and status drift.
- The optional Semgrep payment rules are run for high-risk PRs or replicated in
  Semgrep Cloud / a paid code-review workflow.
- Mainnet deployments do not use inline signing material unless the explicit
  unsafe override is documented and approved.
- High-value Mainnet deployments have an implementation plan for the remote or
  hardware-backed policy signer boundary.

## Release Notes

Release notes for money-handling changes should include:

- Security impact.
- Operator action required.
- Any new environment variables or config fields.
- Any changed Mainnet safety behavior.
- Verification commands run and their results.
