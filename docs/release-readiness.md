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

The scheduled Protocol Monitor should be treated as an operational gate for the
live service once Cloudflare machine-route skip rules are applied. It should
pass against `https://cardano402.com` with the approved minimum confirmation
threshold.

## Money-Handling Review Points

Before release, verify:

- `paymentRequirements` are derived from server-owned configuration, not from
  client input.
- `X-PAYMENT` and `Payment-Signature` request headers remain accepted where
  expected.
- CORS still allows `X-PAYMENT`.
- `/health` exposes non-secret `policy.confirmation` and `policy.signer`.
- `pnpm monitor:protocol -- --base-url https://cardano402.com --min-confirmations 6 --json`
  passes after Cloudflare machine-route rules are applied.
- `facilitator_payment_results_total` is scraped and alerting on invalid
  request spikes, nonce lookup failures, settlement failures, and status drift.
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
