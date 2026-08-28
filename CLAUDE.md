# cardano402

x402 payment facilitator + resource-server SDK for Cardano. Live at
cardano402.com (mainnet). Deploy: `bash deploy.sh` from this directory —
never bypass its guards (master-only, clean-tree, lock, health gate; they
exist because of the 2026-05-27 incident). Runtime config/secrets live in
`config/` + `secrets/` (not in git); don't print them.

## Session record 2026-08-28 (driven from /opt/agent-to-agent)

agent-to-agent.xyz settled the first two real x402 payments through this
facilitator (1 ADA each, mainnet; second completed the full loop: answer +
receipt to the paying agent in 94s). That exercise surfaced and fixed:

- **#134** (fixes #131): `accepted.extra: null` schema asymmetry in
  `@cardano402/core` — every published payer's payment failed `/verify`
  with "expected record, received null". Fixed both sides.
- **#135**: all 46 OSV lockfile alerts cleared (direct bumps + pnpm
  overrides); `scan-pr / osv-scan` green for the first time since early
  Aug 2026.
- **#136 / #137**: all 17 dependabot PRs consolidated and cleared (actions
  bumps; npm bumps incl. lucid 0.5.1 + provider 0.1.95 exact pins). Qodo
  caught a real react/react-dom 19.2.7/19.2.6 mismatch in #137 — fixed
  before merge. #127 (node 25-alpine) declined: non-LTS; node 24 LTS is
  the right deliberate upgrade later.
- **#139** (fixes #138): the production image shipped the HOST's stale
  `packages/core/dist` (bare `dist` in .dockerignore only covers root;
  prod stage installs `--ignore-scripts`), so core changes silently never
  deployed — this is why #134 didn't take effect after the first redeploy.
  Now: `packages/*/dist` dockerignored, core built explicitly in the build
  stage, fresh dist COPY'd into the prod stage.

Deployed twice via deploy.sh; master `31edcc8` is live and was verified
**functionally in the running container** (schema probe via
`docker exec cardano402 node -e "import('@cardano402/core')…"`), not just
by reading source. Do that after every deploy that touches core.

## Open items / traps

- **#132**: payer (`@cardano402/mcp-server`) default 60s request timeout —
  and a 120s schema cap on `requestTimeoutMs` — are both shorter than
  mainnet settle-before-execution (~2 min observed). Agents pay and then
  time out before the answer arrives. Fix: derive the paid-leg timeout
  from the accept's `maxTimeoutSeconds`, lift the cap, expose a CLI flag.
- **#133**: `npx @cardano402/mcp-server` crashes at signer init — npx
  ignores the shipped libsodium overrides. Workaround documented in the
  issue (scratch dir install with explicit npm overrides).
- `ServiceCatalog.registerPaidRoute()` is never called, so the live
  `/.well-known/x402.json` advertises `endpoints: []` while agent
  discovery points crawlers at it.
- POSTs to https://cardano402.com from this VPS get Cloudflare
  bot-challenged (403, `cf-mitigated: challenge`); loopback/docker-network
  access works. agent-to-agent's gate reaches it as
  `http://facilitator:3000` on `cardano402_default`.
- Host `packages/core/dist` may be stale (harmless since #139 — images
  build their own); a host `pnpm install` refreshes it via `prepare`.
- Local git hooks: gitleaks not installed on this VPS (CI covers it);
  lint-staged/typecheck run pre-commit.
