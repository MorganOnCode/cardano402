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
admin-side branch protection/alerting enforcement.

## Branch and commit

- Branch: `feat/mcp-0.1.3-hardening`
- Pull request: `https://github.com/MorganOnCode/cardano402/pull/88`
- Latest security/code change covered by this report:
  Docker image builds now activate the pinned `pnpm@10.8.1` toolchain.
- Previous production runtime hardening head:
  `c16176b fix(compose): harden production runtime defaults`
- A docs-only progress refresh was pushed after that code head:
  `a585aee docs: refresh hardening goal progress`
- Protocol monitor workflow commit: `91b8464 ci: add protocol monitor workflow`
- Main hardening commit: `f6a2b65 feat(mcp): harden agent payment safety`
- Report commit: `ceb2f4e docs: add goal progress report`
- Remote: pushed to `origin/feat/mcp-0.1.3-hardening`
- PR #88 title updated to `feat(mcp): harden agent payment safety and
  production posture`.

Current local status as of the `92c36f1` push: branch
`feat/mcp-0.1.3-hardening` is pushed to origin and backs PR #88.

## Pull request status

Observed on 2026-05-26 UTC for the PR #88 Docker image-build hardening update:

- Local verification for the deployment update completed successfully:
  `pnpm typecheck`, `pnpm lint`, `pnpm security:payments`,
  `pnpm security:release`, `bash -n scripts/backup.sh`, `git diff --check`,
  protected-name scan, production Compose render checks, and empty
  `REDIS_PASSWORD` failure-path checks.
- Follow-up local verification for the development config split completed:
  JSON parse checks for both config templates, `pnpm typecheck`,
  `pnpm security:release`, development and production Compose service renders,
  `git diff --check`, and protected-name scan.
- The previous PR head `0f0f478` completed successfully on GitHub for CodeQL,
  CI, Gitleaks, OSV-Scanner, Dependency Review, and zizmor.
- The Docker image-build hardening update passed local `pnpm typecheck`,
  `pnpm security:payments`, `pnpm security:release`, `git diff --check`, and
  the protected-name scan before push.
- All PR #88 review threads are resolved.

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
- Persistent spend-ledger locks now write a holder PID and recover stale locks
  only when the recorded holder process is no longer alive.
- The spend ledger writes a `.bak` copy after successful persists. If the
  active ledger is corrupt, the tracker restores the valid backup and
  quarantines the corrupt active file. If no valid backup exists, it still
  fails closed instead of silently resetting spend history.
- MCP payment signing now prechecks spend caps and pay-to allowlists before
  elicitation, then still performs an atomic reservation before signing.

### x402 and resource-server compatibility

- `createPaymentGate` now accepts both `Payment-Signature` and `X-PAYMENT`.
- CORS now allows `X-PAYMENT`.
- CORS preflight methods are limited to the public GET/POST API surface instead
  of advertising unused mutation verbs.
- Added regression coverage for the `X-PAYMENT` alias, including a real
  Fastify request through the actual payment gate pre-handler.
- `createPaymentGate` now keeps the nested verify `accepted.network`
  server-owned instead of copying it from the client payment header.
- `/settle` malformed-request failure responses now return the configured
  CAIP-2 network instead of an empty string, keeping error responses aligned
  with the settlement response schema.
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
- Added optional Semgrep payment-security rules at
  `semgrep/payment-security.yml` and exposed them as `pnpm security:semgrep`
  for teams that want AST-aware local or paid-review enforcement.
- MCP HTTP transport bearer tokens now require at least 32 characters at config
  parse and HTTP startup time, and are checked with constant-time comparison
  when configured. Release-readiness guards prevent weakening the agent wallet
  RPC boundary.

### Dependency and audit posture

- CI dependency audit now runs as `pnpm audit --prod --audit-level=moderate`.
- Added a pnpm override for the vulnerable transitive `ip-address` dependency
  path under the Cardano SDK dependency.
- `pnpm audit --prod` currently reports no known vulnerabilities.
- Dependabot now covers npm, GitHub Actions, and Docker ecosystems, and the
  release-readiness gate fails if any of those ecosystems are removed from the
  automation config.
- Release-readiness now also checks the root, core, and MCP npm package
  `files` allowlists, and requires scaffold adapter packages to stay private
  until they are implemented and separately release-reviewed.

### Root facilitator signing-key hardening

- Added `chain.facilitator.seedPhraseFile`.
- Added `chain.facilitator.privateKeyFile`.
- Added explicit `chain.facilitator.signerMode` with the current supported
  root facilitator mode, `local-file`.
- Enforced restrictive POSIX permissions for facilitator signing-key files.
- Mainnet now rejects inline `chain.facilitator.seedPhrase` /
  `chain.facilitator.privateKey` in `config.json` unless
  `CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY=true` is explicitly set.
- Mainnet `local-file` facilitator signing now also requires
  `CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER=true`, making the hot-wallet
  posture an explicit operator acknowledgement until the remote policy signer is
  implemented.
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
- Production metrics bearer tokens now require at least 32 characters, metrics
  bearer headers are parsed strictly, and token comparisons use constant-time
  comparison.
- Sentry event scrubbing now recursively redacts nested `event.extra` config,
  payment header, payment payload, and raw transaction-CBOR fields.
- Sentry startup now honors `config.sentry.environment`, falling back to
  `config.env` only when no Sentry-specific environment is configured.
- Request logging, error-handler Sentry context, 404 responses, and unmatched
  HTTP metrics now avoid raw URL query strings so payment headers or tokens
  cannot leak through misconfigured query parameters.
- Development-mode request logging no longer attaches request bodies, and the
  release readiness gate now fails if body logging or Fastify automatic request
  logging is reintroduced. This keeps signed payment payloads, raw transaction
  CBOR, nonces, and test credentials out of normal logs.
- Malformed `paymentRequirements.payTo` values now return a structured
  `invalid_pay_to` verification failure instead of escaping as a public 500
  during Cardano address canonicalization.
- `/status` now rejects non-hex transaction identifiers before they reach the
  Blockfrost client, preserving the existing `not_found` response for malformed
  polling input while avoiding provider work and avoidable 500s.
- Resource-server payment gates now require
  `settleResult.extensions.status === "confirmed"` before protected route
  execution. Mempool success or missing settlement status returns a 402 instead
  of serving the paid resource.

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

### Production deployment and recovery hardening

- Production Compose now mounts local signing files from `./secrets` into the
  container at `/run/secrets` read-only, matching the documented
  `seedPhraseFile` paths.
- Development-only Redis/IPFS services are now behind a `development` profile
  so `docker compose --profile production up` renders only the production
  facilitator and authenticated Redis services.
- `docker-compose.prod.yml`, the VPS-oriented Compose file, now receives the
  same secret-file mount, fail-fast Redis password interpolation, capability
  drops, and `no-new-privileges` posture.
- `config/config.example.json` now points at the production Redis service name,
  with `docker-compose.prod.yml` providing a `redis-prod` network alias for
  compatibility.
- Encrypted restic backups now include local `secrets/` signing files when the
  directory exists and snapshot both known production Redis volume names.
- Deployment, operations, VPS, backup/restore, README, and release-readiness
  docs now describe the executable file-based secret path.
- Added a separate `config/config.development.example.json` for local
  `pnpm dev` usage so the production-shaped config template can keep
  `redis-prod` and `/run/secrets` defaults without breaking the development
  quickstart.
- Production facilitator containers now run with a read-only root filesystem,
  an explicit `./data:/app/data` mutable storage mount, and `/tmp` tmpfs.
- Production config now exposes `server.trustProxy` and enables it in the
  production template with a numeric trusted-proxy hop count for the documented
  loopback nginx/Cloudflare deployment, so rate limits and logs use the real
  client IP without trusting arbitrary forwarded chains.
- Both production Redis Compose paths now use `maxmemory-policy noeviction` so
  settlement dedup keys fail closed under pressure instead of being evicted.
- Both production Compose paths now pass `NODE_ENV=production` and the
  `MAINNET` guardrail into the facilitator container.
- Both production Compose paths now pass the
  `CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER` hot-wallet acknowledgement into
  the facilitator container, defaulting to `false`.
- Docker build context now excludes local `secrets/` signing files and runtime
  `data/` uploads, and `pnpm security:release` guards those exclusions.
- Docker build stages now activate the pinned `pnpm@10.8.1`
  package-manager version declared in `package.json`, and
  `pnpm security:release` guards that reproducibility invariant.
- CI and protocol-monitor workflows now pin `pnpm/action-setup` to the same
  `pnpm@10.8.1` toolchain, and `pnpm security:release` guards that workflow
  reproducibility invariant.
- The root package publish gate now runs typecheck, full serial tests, payment
  security invariants, release-readiness invariants, and build before any
  publish attempt; `pnpm security:release` guards that gate.

## Live-site findings

Observed on 2026-05-26 UTC:

- `https://cardano402.com/.well-known/x402.json` returns HTTP 200 JSON.
- `/health`, `/supported`, `/verify`, and `/settle` are Cloudflare-challenged
  for non-browser clients.

Most recent monitor evidence, 2026-05-26T08:55:07Z:

- `/.well-known/x402.json`: HTTP 200 JSON.
- `/health`: HTTP 403 Cloudflare challenge, `cf-mitigated: challenge`.
- `/supported`: HTTP 403 Cloudflare challenge, `cf-mitigated: challenge`.
- `/verify`: HTTP 403 Cloudflare challenge, `cf-mitigated: challenge`.
- `/settle`: HTTP 403 Cloudflare challenge, `cf-mitigated: challenge`.

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

- `pnpm --filter @cardano402/mcp-server test -- spend-tracker.test.ts` - 106
  tests passed
- `pnpm --filter @cardano402/mcp-server test -- payment-guards.test.ts` - 104
  tests passed
- `pnpm --filter @cardano402/mcp-server test`
- `pnpm --filter @cardano402/mcp-server typecheck`
- `pnpm --filter @cardano402/mcp-server build`
- `pnpm typecheck`
- `pnpm test tests/unit/sdk/payment-gate.test.ts -- --runInBand` - 19 tests
  passed
- `pnpm test tests/integration/settle-route.test.ts -- --runInBand` - 12 tests
  passed
- `pnpm test tests/unit/plugins/error-handler.test.ts tests/unit/routes/metrics.test.ts -- --runInBand`
  - 33 tests passed
- `pnpm test tests/unit/plugins/request-logger.test.ts -- --runInBand` - 2
  tests passed
- `pnpm test tests/unit/sdk/payment-gate.test.ts -- --runInBand` - 21 tests
  passed
- `pnpm test tests/unit/verify/checks.test.ts tests/unit/verify/verify-payment.test.ts -- --runInBand`
  - 92 tests passed
- `pnpm test packages/core/test/schemas.test.ts tests/integration/status-route.test.ts -- --runInBand`
  - status-route coverage passed in the root suite
- `pnpm --filter @cardano402/core test -- schemas.test.ts` - 71 tests passed
- `pnpm test tests/unit/sdk/payment-gate.test.ts tests/integration/server.test.ts -- --runInBand`
- `pnpm security:payments`
- `pnpm security:release`
- `pnpm audit --prod`
- `pnpm monitor:protocol -- --base-url <local-json-mock> --json`
- `pnpm monitor:protocol -- --base-url <local-json-mock> --min-confirmations 6 --json`
- protected brand search - no matches

Current live monitor status:

- On 2026-05-26 at 08:55:07 UTC, `pnpm monitor:protocol -- --base-url
  https://cardano402.com --min-confirmations 6 --json` failed as expected
  against the live site with the same external Cloudflare challenge posture.
  `/.well-known/x402.json` returned HTTP 200 JSON; `/health`, `/supported`,
  `/verify`, and `/settle` returned HTTP 403 challenge HTML with
  `cf-mitigated: challenge`.
- On 2026-05-26 at 07:39:17 UTC, the same monitor produced the same result.
- On 2026-05-25 at 07:13:06 UTC, `pnpm monitor:protocol -- --base-url
  https://cardano402.com --json` failed as expected against the live site.
- `/.well-known/x402.json` returned HTTP 200 JSON.
- `/supported`, `/verify`, and `/settle` returned HTTP 403 Cloudflare
  challenge HTML with `cf-mitigated: challenge`.
- On 2026-05-25 at 07:29:35 UTC, the expanded monitor also checked `/health`
  with `--min-confirmations 6`; `/health`, `/supported`, `/verify`, and
  `/settle` returned HTTP 403 Cloudflare challenge HTML.
- On 2026-05-25 at 08:57:47 UTC, the live monitor still failed for the same
  external Cloudflare challenge posture while confirming the well-known
  manifest remains reachable.
- This failure is useful evidence, not a repo test regression: the local
  protocol monitor smoke test passes against a JSON mock, and the live failure
  reflects external WAF behavior.

Earlier full-suite verification after the same hardening line:

- `pnpm test -- --runInBand` - 462 tests passed

Additional demo route hardening:

- `/demo/status` now uses the sensitive route limiter and reports
  `configured: false`, `ready: false` when demo wallet configuration is absent.

Additional supply-chain hardening:

- Dependabot version updates now use cooldown windows for npm, GitHub Actions,
  and Docker update surfaces, with `pnpm security:release` guarding those
  cooldown settings.

Additional payment-timeout hardening:

- `/verify` and `/settle` now reject `paymentRequirements.maxTimeoutSeconds`
  values above the configured verification maximum before verification or
  settlement work starts.

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
   tuning, and incident response. The production secret/Compose/backup path is
   now aligned, but quota dashboards and incident procedures still need an
   operator-level pass.
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
