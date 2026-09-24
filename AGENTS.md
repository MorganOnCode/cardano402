# cardano402 (v2)

Keyless Cardano x402 facilitator on Cloudflare Workers, built on the x402
Foundation `@x402/cardano` + `@x402/core` packages. See README.md.

- The Worker lives in `apps/facilitator`. Test with `pnpm --filter
  @cardano402/facilitator test` (tests run inside workerd).
- **Never add a key.** The facilitator is provider-only by design, and CI fails
  if mnemonic or seed wiring appears in `apps/facilitator`.
- Protocol behaviour comes from `@x402/cardano`. Don't reimplement
  verification; upgrade the pinned version (the `x402` dependabot group)
  instead.
- Deploys go through `.github/workflows/deploy.yml` only: preview on
  Cardano Preview testnet; the production website retains the VPS mainnet API and uses the existing production environment approval. Don't run
  `wrangler deploy --env production` by hand.
- `apps/demo-worker` is the separate, private project-funded testnet signer,
  explicitly requested by the owner. Its secret must never be added to the
  facilitator or static assets. It only self-pays on Preview; five runs/day,
  ten-minute cooldown, no new payment while an earlier one is unresolved.
- Preserve the EXACT original v1 landing-page design in apps/facilitator/landing.
  Do not redesign it. Only adapt transport and hosting for Workers. The page is static assets. `/info` retains the agent
  home view. Live demo flags stay off until the free-tier benchmark passes;
  see `docs/portfolio-costs.md`. Do not retire the mainnet VPS until its
  agent-to-agent dependency is removed or replaced.
- `packages/` holds the legacy `@cardano402/*` SDKs (published on npm), which
  are superseded by `@x402/*`. Keep them building, but add no new features.
- v1 (Fastify/Lucid on the VPS, `deploy.sh`) lives at tag `v1-final`, with
  its notes in `docs/v1/`. The staged website cutover (docs/v2-cutover.md) retains
  the VPS mainnet API at `/opt/cardano402`; do not replace tunnel DNS/ingress with Custom Domains.
