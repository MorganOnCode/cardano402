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

The root package `prepublishOnly` gate must continue to run typecheck, full
serial tests, payment invariants, release-readiness invariants, and build before
any publish attempt.

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
- CORS preflight methods remain limited to the public GET/POST API surface.
- Payment headers are decoded through the shared strict codec, have a bounded
  maximum length, and malformed or oversized values fail before facilitator
  verification.
- MCP clients strictly decode untrusted `Payment-Required` response headers and
  reject malformed or oversized values before signing.
- MCP clients reject malformed catalog payment terms before tool registration:
  non-decimal or over-uint64 amounts, malformed CAIP-2 networks, recipient
  addresses with whitespace/control characters, and TTL windows above 3600s.
- MCP clients bound and schema-check `X-Payment-Response` / `PAYMENT-RESPONSE`
  headers before surfacing paid-response metadata to agents.
- MCP HTTP transport bearer tokens are at least 32 characters and are compared
  in constant time when configured.
- `/verify` and `/settle` strictly decode raw `paymentHeader` request bodies and
  bound their size before verification or settlement work starts.
- `/verify` and `/settle` reject `paymentRequirements.maxTimeoutSeconds` values
  above the configured verification maximum before verification or settlement
  work starts.
- Transaction CBOR payloads are strictly base64-decoded and size-bounded before
  CBOR parsing or settlement submission.
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
- Production `metrics.bearerToken` values are at least 32 characters, metrics
  Authorization headers are parsed strictly, and comparisons are constant-time.
- The optional Semgrep payment rules are run for high-risk PRs or replicated in
  Semgrep Cloud / a paid code-review workflow.
- Mainnet deployments do not use inline signing material unless the explicit
  unsafe override is documented and approved.
- Mainnet `local-file` signing requires the explicit
  `CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER=true` hot-wallet acknowledgement;
  high-value Mainnet deployments use the remote or hardware-backed signer plan
  instead of this override.
- Production deployments with the live demo enabled use `demo.seedPhraseFile`
  for a separate Preview/Preprod demo wallet; inline demo seed material is
  rejected in production.
- Public quota- or transaction-consuming routes, including `/demo/run` and
  `/demo/status`, use the tighter sensitive route rate limit instead of only
  the global limiter.
- `/demo/status` reports `configured: false` and `ready: false` when demo
  wallet configuration is absent.
- Backup and restore scripts reject loose restic credential-file permissions and
  restore snapshots only into private directories.
- Docker build context excludes local `secrets/` signing material and runtime
  `data/` uploads.
- Docker build stages activate the pinned `pnpm@10.8.1` package-manager version
  declared in `package.json`.
- CI and protocol-monitor workflows pin `pnpm/action-setup` to the same
  `pnpm@10.8.1` toolchain used by local and Docker builds.
- Dependabot covers npm, GitHub Actions, and Docker ecosystems so dependency,
  workflow, and image updates are surfaced for review.
- Dependabot version updates use cooldown windows for npm, GitHub Actions, and
  Docker so fresh releases have time to settle before routine update PRs;
  security updates are still created immediately by GitHub.
- Root, core, and MCP package manifests keep explicit npm `files` allowlists so
  source, scripts, test fixtures, local config, generated data, and secrets are
  not packed accidentally.
- Scaffold adapter packages remain `private: true` until they are implemented
  and separately release-reviewed.
- Production Compose fails fast without `REDIS_PASSWORD`, binds production
  ports to loopback, and drops unnecessary container privileges.
- Production Redis uses AOF and `maxmemory-policy noeviction` so settlement
  dedup keys are not silently evicted under memory pressure.
- Production config sets `server.trustProxy` to a numeric trusted-proxy hop
  count only for the documented loopback reverse-proxy deployment so rate
  limits/logs use real client IPs without trusting arbitrary forwarded chains.
- High-value Mainnet deployments have an implementation plan for the remote or
  hardware-backed policy signer boundary.

## Release Notes

Release notes for money-handling changes should include:

- Security impact.
- Operator action required.
- Any new environment variables or config fields.
- Any changed Mainnet safety behavior.
- Verification commands run and their results.
