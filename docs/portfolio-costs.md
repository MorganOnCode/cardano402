# Portfolio hosting and bounded testnet demo

The owner's latest instruction is to preserve the **EXACT original page design**,
not replace it with a new portfolio or simulation page. The v1 landing source
is restored under `apps/facilitator/landing`: Normal/Dev modes, original fonts,
CSS, artwork, sections and demo panel. `pnpm build:landing` bundles React and
copies the page to Workers Static Assets. The page retains its original Google
Fonts stylesheet; no wallet SDK is shipped to the browser.

Only the demo transport changes: same-origin JSON requests to the private
Worker flow replace the VPS SSE stream. There is no `/demo/status` polling.
The original UI displays confirmed receipts and errors; it never labels a
pending payment as settled. Technical mode fetches shallow health/capabilities
on demand. No redesigned simulation page remains.

The preview live demo is now enabled after the revised benchmark below passed.
Production remains disabled; the main domain and agent-to-agent still use the
VPS. Its old testnet demo is paused so only one service signs for the wallet.

## Live demo: same wallet sends, receives, and pays fees

The current VPS demo uses **Cardano Preview**, not preprod. The replacement
uses that same network and reuses its dedicated test wallet at secret migration.
`apps/demo-worker` is a separate private Worker, with no public routes,
workers.dev hostname, or preview URLs. Only the facilitator's `DEMO` service
binding calls it. Its single SQLite Durable Object signs a fixed 2 test ADA
self-payment. The reference @x402/cardano client and facilitator perform the
real verify/settle flow. The receipt links to preview.cardanoscan.io.

The receiving address is derived from the configured test wallet. Visitors
cannot set the recipient, amount, network, transaction bytes, or provider URL.
The signing service pins the Preview provider URL and requires a Preview
Blockfrost key. The signing secret never enters the facilitator or static site.
Only migrate the dedicated demo wallet: never use the mainnet facilitator seed.
Run only one active signer for that wallet: pause the VPS demo before live
Worker testing, then disable the preview environment before enabling production.
The two environments have separate Durable Object state and do not share a lock.

- Maximum **5 newly started runs per UTC day**, including failed preparation.
- **10-minute cooldown**; concurrent and recent visitors share a receipt.
- Signed bytes are persisted before submitting. Restart resumes those bytes.
- Maximum **2 settlement attempts per transaction**. No new payment is made
  while an earlier one is unresolved, even after a restart or cooldown.
- Signing provider operations time out after 30 seconds. The page allows
  210 seconds per request and makes at most two calls on a click, never
  background polling. A timeout never authorizes a replacement transaction.
- The facilitator caps payment calls at 100/day, SDK provider operations at
  1,000/day, and explicit deep-health probes at 4/day. These are shared atomic
  limits, in addition to the 12 requests/minute/IP limiter. SDK operations can
  issue multiple upstream HTTP requests, so the operation cap is not an exact
  Blockfrost request meter.
- Confirmation evidence is checked every 15 seconds for up to 75 seconds per
  settlement attempt. The scheme retains its duplicate-broadcast protection.
- Protocol parameters alone are cached for 60 seconds in each isolate. UTXO
  spentness, submission results, and transaction evidence are not cached.
- Settlement cleanup sleeps until an expirable record's retention deadline,
  then stops when none remain. It never deletes rejection/in-flight records
  just to save space. The test wallet has no alarms. Monitoring is manual.

An unresolved demo after two attempts intentionally stops new spending.
An operator must inspect its transaction and inputs on Preview before clearing
or repairing the saved `run` state. Never clear it simply to unstick the UI.
A recorded receipt may be shared during cooldown; the UI labels reused results.

## Free-tier target, not a measured guarantee

Workers Free currently includes 100,000 requests/day with 10 ms CPU per ordinary
Worker request. SQLite Durable Objects have a free allowance, with a larger
per-invocation CPU allowance. Signing is inside a Durable Object, but the
facilitator still needs real CPU profiling. Low request volume alone does not
prove it fits. Waiting on the network does not count as ordinary Worker CPU;
Durable Object duration has its own accounting.

No paid subscription or account-plan change is made by these files. Free-plan
limits stop requests rather than create usage overages. If the account is
already paid, caps reduce use but do not cancel the account's base subscription.
Domain renewal remains separate. Production flags remain disabled in both Workers. Preview flags are enabled
only for the isolated live benchmark; enabling only one Worker must not allow
spending.

Official references (checked 2026-09-24):
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

## Before enabling the live demo

1. Authenticate Wrangler/CI and confirm the Cloudflare account's actual plan.
2. Configure `BLOCKFROST_PROJECT_ID` (Preview) on both Workers. Migrate the
   existing VPS **demo** seed to `DEMO_TESTNET_MNEMONIC` on the private demo
   Worker only, using secret input without printing it. Do not place secrets
   in Git, the static assets, workflow variables, or tool output.
3. Deploy both Workers through the GitHub workflow with live flags still off.
   When bootstrapping the mutually bound services, create the two private
   service names first if Cloudflare requires targets to exist before binding.
4. In the preview environment only, enable `LIVE_DEMO_ENABLED` in both configs
   and run one real funded Preview payment. Record its transaction link,
   `/verify` and `/settle` CPU time (including cold requests), Worker errors,
   provider call count, Durable Object duration, and bundle/startup measurements.
   An elapsed-time measurement on a VPS is NOT Cloudflare CPU evidence.
5. Exercise five-run quota exhaustion, repeated clicks, disabled mode, pending
   confirmation, restart/resume, and a closed browser during settlement.
6. If ordinary requests exceed the free-tier CPU limit, profile and move that
   work into a bounded Durable Object or keep the live demo disabled. Do not
   automatically upgrade the account. Enable production only after the
   measurement and a successful testnet receipt are recorded.

The original page renders when the signing service is disabled; clicking Test Now reports that the live demo is unavailable.
The original page has been deployed to the preview URL; live benchmark
measurements are recorded below.

## Local validation record (2026-09-24)

The earlier 9 KB redesigned page and its browser validation were superseded
by the owner’s instruction to preserve the original design. They are not
validation evidence for the restored original page.

Both Worker builds and type checks passed. All 30 workerd tests passed in final serial runs. They cover
atomic quotas, no idle alarms, concurrent visitors, durable resume, no new
transaction after ambiguous settlement, and testnet-only configuration.

The existing Preview wallet successfully built and signed a 2 test ADA
self-payment in a local Node probe without submitting it. The integrated
live test could not complete preparation/verification: requests timed out
while the shared VPS load exceeded 80 and swap was nearly full. No transaction
was submitted by the demo. A direct provider read also succeeded but took
about 30 seconds; these measurements cannot isolate provider latency from
local resource pressure. Temporary local credential copies were removed.

A confirmed chain receipt and Cloudflare free-tier CPU measurements remain
required before enabling live flags. No claim of a successful live migration
or guaranteed $0 compute is made by the local tests.

## Recovery checkpoint (2026-09-24, 20:14 UTC)

Resumed from the preserved, uncommitted portfolio changes on branch `v2` in
`/home/morganic/work/cardano402-v2`. Fresh validation passed: 30 Worker tests,
162 legacy SDK tests, workspace type checks and lint, both Worker dry-run
bundles, both legacy SDK builds, and `git diff --check`.

Wrangler was unauthenticated and GitHub repository deployment secrets and
variables were absent. The owner selected browser login; device authorization
returned HTTP 403, so the localhost callback flow was started. Authentication
is not yet confirmed. No deployment, DNS change, or payment was performed.

The existing VPS Cardano402 and agent-to-agent containers remain healthy.
Agent-to-agent's production Compose file still defaults to
`http://facilitator:3000`. PR #163 still describes the earlier keyless-facilitator
plan; its description needs updating when these portfolio changes are pushed.
Next: complete Cloudflare authentication, inspect account plan and existing
Workers, prepare CI deployment credentials, and resolve initial service-binding
bootstrap before deploying the disabled preview demo through GitHub Actions.

## Authentication and design correction (2026-09-24)

The OAuth callback reached Wrangler, but its token exchange received an HTML
bot challenge (HTTP 403, Ray ID `a4048699bad0a0af-FRA`). No login was saved.
Use a Cloudflare API token for CI/deployment access instead of repeating this
VPS OAuth flow. No secrets are stored in this document.

The owner explicitly rejected a redesign: preserve the exact original page.
The source is copied from the live `/opt/cardano402/landing` checkout, with
changes confined to demo transport and truthful response labels. Original
HTML/CSS and all other components are preserved byte-for-byte.

Restoration validation: original HTML/CSS, artwork, hooks and all non-demo
components match the VPS source byte-for-byte. Headless Chromium compared
body text, computed body font and section dimensions at 1440px and 390px in
both Normal and Dev modes; all matched. The restored page made zero idle API
requests and had no JavaScript errors. Mocked browser checks passed for the
disabled demo, a confirmed explorer receipt, and pending settlement (at most
two calls, no false settled receipt). No payment was made. Worker build,
typecheck, lint and 24 facilitator workerd tests passed. The original source
has an existing duplicate `fontFamily` build warning, preserved with its design.
Local smoke checks passed for the static page, disabled verification and
shallow health; `/info` and `/supported` require a configured Preview
Blockfrost key and did not pass in the credential-free dev server.

## API access restored (2026-09-24)

The supplied Cloudflare API token verified as active. GitHub encrypted secrets
now contain `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the existing
Preview demo provider key as `BLOCKFROST_PREVIEW_PROJECT_ID`. The signing seed
has not been copied. Live flags remain disabled.

The account has no Cardano402 Workers and reports no workers.dev subdomain.
Billing/subscription inspection is denied by the token, so the account plan
still needs confirmation in the dashboard before live benchmark work. The
zone's Free Website plan is not proof of the Workers billing plan.

The deploy workflow now builds the original page and creates a private,
unrouted placeholder only when its binding target is absent. Bootstrap checks
passed for existing-service skip, denied access (no mutation), and missing
service creation with workers.dev/preview URLs disabled. Deployment remains
gated by `CLOUDFLARE_DEPLOY_ENABLED`; no Worker or DNS change has been made.

## First live benchmark (2026-09-24)

The owner confirmed Workers Free. Preview deployment and all smoke tests
passed. The exact original page remains at
https://cardano402-preview.morganoncode.workers.dev.

Before enabling the preview signer, the old VPS demo configuration was backed
up under root-only `/etc/cardano402/cloudflare-migration/` and removed from the
runtime config. After a graceful container restart, mainnet health and
agent-to-agent health were verified; old `POST /demo/run` returns 503. The
existing demo seed was uploaded only to `cardano402-demo-preview` as a Worker
secret. Production has no signing secret or enabled live flag.

First confirmed self-payment:
https://preview.cardanoscan.io/transaction/1ded03b19e9e90896e23afdc580834c3ab406f2c13de73bce83496e04528a992

Blockfrost independently confirms a 2,000,000 lovelace output, with all input
and output addresses equal to the project Preview wallet. Fee: 170,165
lovelace. The full demo took approximately 49 seconds.

Cloudflare invocation logs measured 118 ms CPU for `/verify` and 56 ms for
`/settle` as ordinary Worker requests. Although the transaction completed,
these exceed the 10 ms Free allowance and are **not a passing benchmark**.
`/demo/run` used 4 ms CPU. Verification and settlement are therefore moved
without protocol changes into a separate `PaymentExecutor` Durable Object;
the HTTP Worker retains body validation, network guards and atomic budgets.
The SDK result crosses RPC as JSON to preserve arbitrary protocol extensions.
A second benchmark is required before considering the demo ready.

## Revised benchmark passed (2026-09-24)

Commit `a617d7f` deployed through GitHub run `36059100006`; all CI checks and
live smoke checks passed. Clicking **Test Now** in headless Chromium on the
original deployed page produced a confirmed receipt with no browser errors:
https://preview.cardanoscan.io/transaction/526d52ce29f159d021b5270fa6063548157ca0eadbf6dd24bd4fe46d2a974f6f

Blockfrost independently confirmed the same-wallet inputs and outputs, a
2,000,000 lovelace payment output and 170,165 lovelace fee. This run completed
in approximately 19 seconds. It was the second newly started demo of the day;
no quota or cooldown state was cleared to run it.

Cloudflare execution measurements for that payment:

| Execution | CPU | Wall time | Result |
|---|---:|---:|---|
| HTTP `/verify` (first real request after deployment) | 5 ms | 1,919 ms | OK |
| HTTP `/settle` | 1 ms | 15,895 ms | OK |
| HTTP `/demo/run` | 3 ms | 19,153 ms | Complete HTTP 200 receipt received |
| Durable Object verification RPC | 83 ms | 1,148 ms | OK |
| Durable Object settlement RPC | 52 ms | 30,819 ms | OK |

The front-door demo invocation is tagged `canceled` in Cloudflare telemetry
despite curl and Chromium receiving complete 200/confirmed responses; the
chain receipts were independently checked. The reason for that telemetry
classification has not been established. The settlement RPC trace remained
open longer than the HTTP response. No CPU-exceeded or memory-exceeded errors were observed.

The ordinary HTTP requests now fit the 10 ms Free allowance in this measured
run; cryptographic work runs under the Durable Object allowance. This is
measured evidence for the bounded demo, not a guarantee for every request or
other applications sharing the account. The five-start/day cap, ten-minute
cooldown, 100-payment-call/day and 1,000-provider-operation/day limits remain.

Cloudflare's periodic metrics for the signing object during the second run
recorded about 418 ms CPU and 7.68 GB-seconds of active duration (metrics use
microseconds for CPU/active time). Its six subrequests include the facilitator
service calls, so this is not a pure Blockfrost request count. The settlement
store recorded 35 rows read and 19 written in that query window.

Both Worker bundles are below the Free upload limit: public 2,890.47 KiB raw /
551.47 KiB gzip; private 2,717.53 KiB raw / 511.36 KiB gzip. Deployment reported
165 ms and 166 ms startup respectively.

The first receipt survived the redeployment and was reused during cooldown.
After the second payment, two concurrent callers both received its cached
receipt with no new transaction. Synthetic workerd tests cover quota
exhaustion, pending confirmation and restart/resume; they do not require
spending extra test ADA. The updated facilitator suite has 25 passing tests.

Preview stays enabled for review on Workers Free. Production and domain
cutover remain out of scope until agent-to-agent's mainnet dependency is
resolved. The old VPS demo must remain paused while the preview signer is on.
