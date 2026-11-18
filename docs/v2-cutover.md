# Static website cutover and VPS retirement

cardano402.com becomes a static archive on Cloudflare: the original landing
page (without the live demo), a banner linking to the x402 Foundation's
[exact scheme for Cardano](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md),
static agent notes and a 404 page. No facilitator, demo, proxy or discovery
API runs on Cloudflare for the website. Retiring the VPS is a later, separate
phase with its own approvals.

Until the production step below is approved and run, nothing changes: the VPS
keeps serving the whole domain, including the mainnet API.

## What is deployed

`apps/facilitator/wrangler.website.jsonc` deploys the Worker `cardano402-website`
with **static assets only** from `apps/facilitator/website-dist/`
(`pnpm build:website`). It has no `main` script, bindings, variables or
secrets. Production attaches two Workers **Routes**, `cardano402.com/*` and
`www.cardano402.com/*`, on the existing proxied DNS records.

| Request | Response |
|---|---|
| `GET`/`HEAD` `/`, `/dist/app.js`, `/favicon.svg`, `/og-image.svg`, `/llms.txt`, `/SKILL.md`, `/robots.txt` | Static file with the `_headers` CSP |
| `GET /info` | 302 to `/llms.txt` (`_redirects`) |
| Every other path: `/supported`, `/verify`, `/settle`, `/status`, `/health`, `/.well-known/x402.json`, `/demo/*`, unknown | 404 with `404.html` (`not_found_handling: 404-page`), never the landing page |
| Any method other than `GET`/`HEAD` | 405 |

Because there is no Worker script, Cloudflare answers every request on those
routes from the asset store: no request reaches the tunnel or the VPS, even
though DNS and tunnel ingress are left unchanged. Cloudflare documents that
requests are only billable when a Worker script is invoked
([static site routing](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/),
updated 2026-08-25), and that static asset requests are free and unlimited.

`test/fixtures/website-routes.json` lists every expected response.
`pnpm --filter @cardano402/facilitator test:website` serves the built site
through Wrangler's local asset router (with the real `_headers` and
`_redirects`) and fails if any case differs or reaches a stand-in origin. CI
runs it on every pull request without credentials.

## Setup checked read-only (2026-11-18)

- DNS: apex and `www` resolve to Cloudflare proxy addresses (both A and AAAA);
  nameservers are Cloudflare; no CAA record, so CAA does not restrict certificate issuance.
- Tunnel: `/etc/cloudflared/config.yml` has ingress for `cardano402.com` and
  `www.cardano402.com`, ending in `http_status:404`. Routes need these proxied
  records to stay; the cutover does not change them.
- Workers, routes and custom domains: **not checked**. No Cloudflare
  credential is available outside GitHub Actions. Owner check: Workers &
  Pages → `cardano402-website` → Domains & Routes, and the zone's Workers
  Routes list (the zone had none on 2026-09-24).
- GitHub: environment `production` requires reviewer `MorganOnCode` and is
  limited to `master`; environment `preview` has no protection rules.
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are **repository**
  secrets, so any workflow on a pushed branch could reference them. Move both
  to the `production` and `preview` environment secrets (owner action) so only
  environment-gated jobs can read them. `CLOUDFLARE_DEPLOY_ENABLED` is `true`.
- Workflow: `deploy.yml` has no push or pull-request trigger. It runs only by
  hand from `master`; the old preview and demo deployment is removed. CI
  (`ci.yml`) never receives Cloudflare secrets.
- Branch protection still requires the `Testnet demo Worker` check, so the
  `demo` CI job remains until that requirement changes.

## Stage 1: staged static preview (no production change)

1. Merge the reviewed PR. Nothing deploys on merge.
2. Actions → Deploy website → Run workflow on `master` with `target=staging`.
   It deploys `cardano402-website-staging` on workers.dev (no routes) and runs
   `scripts/smoke-website.mjs`, which compares `/`, `/dist/app.js`, `/llms.txt`
   and `/SKILL.md` byte for byte with the build and prints their SHA-256
   prefixes. It sends only `GET` requests.
3. Review the staging URL on desktop and mobile, in Normal and Dev modes:
   banner link opens the specification, no demo panel, no browser console
   errors, `/supported` shows the 404 page.

## Stage 2: production website (needs approval)

1. Confirm no outstanding operation depends on public cardano402.com API
   paths (see the checklist). After this step external x402 clients get 404s.
   agent-to-agent is not affected: it calls `http://facilitator:3000` on the
   Docker network, not the public hostname.
2. Run the workflow with `target=production`; approve the `production`
   environment. It deploys `cardano402-website` with both routes and runs the
   smoke check against both hosts.
3. Record the route IDs and the printed asset hashes. If the smoke check
   reports a Cloudflare challenge (`cf-mitigated`), that is **not** a pass:
   verify from a browser, and investigate the zone's bot settings rather than
   weakening them.
4. Check TLS on both hosts in a browser (valid certificate, no mixed content).

### Rollback

Delete the two `cardano402-website` routes (Workers & Pages →
`cardano402-website` → Domains & Routes). DNS and ingress are unchanged, so the
VPS immediately serves the whole domain again, including the old API. Keep
the Worker for diagnosis and do not rerun the production target until the
cause is fixed. No service restart, DNS change or cache purge is needed.

### Expected savings

Website stage only: about 1,800 page loads and 1,100 demo polls a month stop
reaching the VPS (30-day estimate from the VPS usage audit). **No disk or RAM
is freed** by this stage, because the container still serves agent-to-agent.
Cloudflare cost is expected to be $0: assets-only requests are not Worker
invocations (Workers Free, owner-confirmed plan).

## Stage 3: retire the VPS service (separate approvals)

Do not start until stage 2 has soaked and every item below is resolved.

- [ ] **Live asset hash:** the production smoke hashes match the build of the
      deployed commit on both hosts.
- [ ] **TLS:** both hosts serve a valid Cloudflare certificate.
- [ ] **agent-to-agent private dependency:** its `/paid/ask` calls
      `http://facilitator:3000` (`FACILITATOR_URL`), its catalog advertises
      `https://cardano402.com`, and its compose file requires the external
      network `cardano402_default`. Disable or repoint that paid route and
      update the catalog first. Use `docker compose stop`, not `down`, while
      agent-to-agent still needs the network.
- [ ] **Outstanding operations:** confirm no settlement is in flight and no
      reservation is pending in `cardano402-redis` before stopping
      (operator check).
- [ ] **Wallet recovery:** prove the mainnet signer can be restored from the
      off-host backup before anything is removed. Wallet accounting and any
      sweep need their own authorization.
- [ ] **Off-host backup restore:** nightly restic to R2 (`/etc/cron.d/cardano402-backup`,
      verified by `/etc/cron.d/backup-verify`). Run and record a test restore of
      the signer, config and Redis data.
- [ ] **Cron, monitor and tunnel inventory:** remove `cardano402-backup` only
      after the final archive; keep `backup-verify` coverage for the shared
      tunnel. Repoint or delete the UptimeRobot `/health` monitor. Remove the
      two cardano402 ingress entries only when the website no longer needs the
      tunnel records (or after moving to Custom Domains, which is a DNS change).
- [ ] **Containers and images:** `cardano402`, `cardano402-redis`, the
      exited `cardano402-rehearsal-*` containers, the `cardano402:rollback`
      image. Keep them through a 14-day soak.
- [ ] **Stashes and local copies:** `~/work/cardano402-v2` has two stash
      entries; preserve or ask the owner before removing that copy.
- [ ] **Cloudflare leftovers:** retire `cardano402-preview` and
      `cardano402-demo-preview` and their secrets (Cloudflare change; the
      Preview test ADA has no value).
- [ ] **Credentials:** rotate or revoke the mainnet Blockfrost key, Redis
      password and signer after retirement (separate authorization).

## Remaining blockers

- Owner approval for each production step; Cloudflare-side route state is
  unverified from here.
- A decision on agent-to-agent's paid route before the VPS can stop.
- The 2026-09-25 attempt saw Cloudflare return 403 to the GitHub runner on
  `/supported`. The new smoke check reports such a challenge as a failure; if
  it recurs, check from a browser and review the zone's bot rules.
