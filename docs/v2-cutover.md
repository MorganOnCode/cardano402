# Staged website cutover

The Cloudflare preview passed a real Preview testnet payment benchmark and
owner review. The next deployment moves the original website to Cloudflare
while preserving the existing mainnet API and agent-to-agent dependency.

## Routing prepared for production

`apps/facilitator/wrangler.website.jsonc` deploys `cardano402-website` through
`.github/workflows/deploy.yml`, from `master`, behind the existing GitHub
`production` required-reviewer gate. It uses Workers **Routes**, not Custom
Domains, for `cardano402.com/*` and `www.cardano402.com/*`.

| Request | Destination |
|---|---|
| `/`, `/index.html`, `/dist/app.js`, existing image assets (including query strings) | Original static assets on Cloudflare |
| `POST /demo/run` | Service binding to the existing preview demo endpoint |
| All other paths, including `/verify`, `/settle`, `/supported`, `/health`, `/info`, and agent discovery | Original request forwarded to existing VPS tunnel origin |

Cloudflare serves matching static assets before invoking the website Worker.
The website Worker delegates only the demo POST to `cardano402-preview`,
which retains its rate limiter and private demo service. The same wallet
Durable Object owns both entry points, so receipts, five-start/day quota,
ten-minute cooldown and unresolved-payment protection remain shared. No
second wallet secret, production signer, or provider credentials are added.
Other requests use `fetch(request)` without changing method, body, headers,
URL or query. This relies on the origin behavior of
[Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/).
Do not convert these routes into Custom Domains while the origin is needed.

Keep both proxied tunnel DNS records and **all** tunnel ingress entries.
Do not restart or remove the tunnel or mainnet containers. The old VPS
testnet demo remains paused. The existing agent-to-agent paid flow continues
using `http://facilitator:3000`; its draft v2 PR is not part of this cutover.

## Deployment and verification

1. Merge the reviewed v2 PR after CI passes. The workflow deploys and checks
   preview first, then waits for the `production` reviewer. Approve the
   website job only after confirming this staged routing is intended.
2. The production job first verifies mainnet discovery on both existing hosts
   before changing any routes. It then builds the original page and deploys the website config.
   It does not deploy a second demo service or replace the mainnet API.
3. Automatic smoke checks compare deployed HTML and JavaScript byte-for-byte
   with the build on both hosts, then verify `/supported` still advertises
   `cardano:mainnet`. They never submit a payment. Cloudflare challenges must
   not be treated as a passing API check; investigate scoped rules if needed.
4. Check desktop/mobile and Normal/Dev modes on the real domain. Check the
   testnet receipt in the page (a new click may spend test ADA within the
   shared quota), the explorer link, and browser errors.
5. Verify local mainnet health and agent-to-agent health. A healthy response
   is not proof of a new paid mainnet transaction; do not spend mainnet ADA
   as part of these checks.

## Preflight findings (2026-09-24)

The VPS can read local mainnet discovery, but an external request from the VPS
to `https://cardano402.com/supported` receives Cloudflare HTTP 403. No global
bot/security settings were changed. The deployment preflight must pass from
GitHub before routes are attached; scoped machine-access rules may still be
needed if that runner is challenged too. The token can list Workers Routes
but cannot read DNS records or WAF rulesets. This plan does not change DNS.

Master branch protection still requires four obsolete VPS CI checks. Approval
was requested to replace those with `Facilitator Worker`, `Testnet demo Worker`,
`SDK packages`, and `No seed material in source`, preserving strict/up-to-date
checks and every security requirement. The required `Security Audit` job is
restored with `pnpm audit --prod --audit-level high`; locally it reports no
known vulnerabilities. Do not bypass branch protection or production approval.

## Rollback

Before cutover, the zone had no Worker routes (checked 2026-09-24). Record the
route IDs created by this deployment. If smoke checks fail, delete only the
two `cardano402-website` routes in Cloudflare's Workers Routes UI/API. Keep the
Worker available for diagnosis. The unchanged DNS and ingress immediately
send the full site back to the VPS. Disable/revert the website production job
before another deployment so it does not reattach the routes.

Do **not** delete shared tunnel configuration, reset Durable Object state,
restore the old demo config, or restart services for this rollback. The old
page will return, with its old testnet demo still paused. To restore that
old demo later, first disable the Cloudflare signer and resolve any pending
payment; only then restore the backed-up demo configuration.

## Later: retiring the mainnet VPS

Website cutover does not retire the VPS. First remove agent-to-agent's paid
flow or select and verify a replacement mainnet facilitator, and handle other
public API consumers. Only then change API/discovery routing and stop the old
Cardano402 container. Keep Redis and signing backups for rollback. After a
14-day soak, separately authorize wallet accounting/sweeps and remove obsolete
containers, volumes and backup jobs; shared tunnel backup coverage must remain.
