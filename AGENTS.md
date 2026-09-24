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
  preprod, production on mainnet behind environment approval. Don't run
  `wrangler deploy --env production` by hand.
- `packages/` holds the legacy `@cardano402/*` SDKs (published on npm), which
  are superseded by `@x402/*`. Keep them building, but add no new features.
- v1 (Fastify/Lucid on the VPS, `deploy.sh`) lives at tag `v1-final`, with
  its notes in `docs/v1/`. Until cutover (docs/v2-cutover.md) the VPS still serves
  cardano402.com from the `master` checkout at `/opt/cardano402`.
