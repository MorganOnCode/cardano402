# Cutover runbook: cardano402.com, VPS (v1) to Worker (v2)

Owner approval is required at every step marked **(approve)**. Nothing here
runs automatically.

## Before

1. Preview Worker green on `cardano:preprod`: CI deploy + `scripts/smoke.mjs`
   pass, and one real preprod payment settles end to end through an
   `@x402/core` resource server (agent-to-agent's v2 PR against the preview URL).
2. Production Worker deployed with **no routes** (`wrangler deploy --env
   production`); `BLOCKFROST_PROJECT_ID` (mainnet) set as a secret; smoke
   against its `workers.dev` URL or a temporary hostname.
3. agent-to-agent v2 PR merged but pointed at the preview facilitator until the
   switch.
4. Announce: v1-only features go away. `/demo`, `/status/:tx`,
   `/upload`/`/download`, `/.well-known/*` cards, `/metrics`, and the v1 wire
   quirks (`extensions.status`, settle-before-handler) are all removed.

## Switch (approve)

1. Stop new v1 settlements: `docker stop cardano402` on the VPS. Leave
   `cardano402-redis` and its volume untouched. Redis `settle/*` records only
   deduplicate v1 access grants. Cardano itself refuses a second broadcast of a
   spent-input transaction, so v1 records do not need to move.
2. Add the custom-domain routes to `env.production` in `wrangler.jsonc`
   (`cardano402.com`, `www.cardano402.com`), merge to master, approve the
   production deployment. Remove the cloudflared ingress rule for those
   hostnames in the same change window.
3. `node apps/facilitator/scripts/smoke.mjs https://cardano402.com cardano:mainnet`.
4. Point agent-to-agent's `FACILITATOR_URL` at `https://cardano402.com` and
   redeploy it. It no longer joins the `cardano402_default` Docker network.
5. Set repo variable `PRODUCTION_URL=https://cardano402.com` to enable the
   hourly monitor.

## Rollback

Re-add the cloudflared ingress, remove the Worker routes, and run `docker start
cardano402`. The v1 container and its Redis volume stay stopped but intact
through the soak period.

## After a 14-day soak (approve each)

- Sweep the remaining ADA from the v1 facilitator and demo wallets to a cold
  wallet. Then shred `secrets/*.seed` on the VPS; the restic snapshots keep an
  encrypted copy under the existing retention.
- Remove the v1 containers, images (`cardano402:latest`, `cardano402:rollback`),
  the Redis volume, the backup cron, and `/opt/cardano402` (~1.5 GB).
- Delete `mcp.cardano402.com` DNS or point it at the Worker.
