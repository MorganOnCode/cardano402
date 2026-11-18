# cardano402

An open-source portfolio project exploring HTTP payments on Cardano using the
x402 Foundation's `@x402/cardano` reference implementation.

> **Specification:** the x402 payment scheme for Cardano is the x402
> Foundation's [exact scheme for Cardano](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md).
> cardano402 implements it; no endorsement by the Cardano Foundation or the
> x402 Foundation is implied.

The cardano402.com website is a **static archive**: the original landing-page
design (Normal/Dev modes, typography, illustrations) with a banner pointing to
the specification above, static agent notes (`/llms.txt`, `/SKILL.md`) and a
404 page. The live demo panel is removed, and the website no longer offers
or forwards to a payment, verification, settlement or discovery API.

## Architecture

- `apps/facilitator/landing`: original v1 React page source and artwork.
- `apps/facilitator/site`: website-only static files (`llms.txt`, `SKILL.md`,
  `robots.txt`, `_redirects`, `404.html`).
- `apps/facilitator/wrangler.website.jsonc`: the static website. Assets only:
  no Worker script, bindings or secrets.
- `apps/facilitator/src`: keyless x402 facilitator Worker (Cardano Preview),
  kept as source. It is **not** part of the website and the deploy workflow no
  longer deploys it.
- `apps/demo-worker`: the former private Preview demo signer, kept as source;
  no longer deployed by the workflow.
- `packages/`: preserved legacy `@cardano402/*` SDKs, superseded by `@x402/*`.

## Develop and check

```sh
pnpm install --frozen-lockfile
pnpm --filter @cardano402/facilitator test:website   # build the static site + offline routing fixtures
pnpm --filter @cardano402/facilitator --filter @cardano402/demo-worker typecheck
pnpm --filter @cardano402/facilitator --filter @cardano402/demo-worker test
pnpm --filter @cardano402/facilitator --filter @cardano402/demo-worker build
```

`test:website` serves `website-dist/` through Wrangler's local asset router
and checks every case in `apps/facilitator/test/fixtures/website-routes.json`
against a local stand-in origin that must never be reached. No credentials or
network access to cardano402.com are used.

## Website routes

| Request | Response |
|---|---|
| `GET`/`HEAD` `/`, `/dist/app.js`, images, `/llms.txt`, `/SKILL.md`, `/robots.txt` | Static file, with the strict CSP from `_headers` |
| `GET /info` | 302 to `/llms.txt` |
| Any other path, including the retired `/supported`, `/verify`, `/settle`, `/status`, `/health`, `/.well-known/x402.json`, `/demo/*` | 404 with the static `404.html` (never the landing page) |
| Any method other than `GET`/`HEAD` | 405 |

## Deployment and cost

`.github/workflows/deploy.yml` runs only when started by hand from `master`:
`target=staging` deploys a workers.dev review copy; `target=production`
attaches the `cardano402.com` and `www` Workers Routes after the `production`
environment reviewer approves. Pushes and pull requests never deploy. With no
Worker script, requests are served as static assets and are not billed as
Worker invocations. See the [static website cutover and VPS retirement
runbook](docs/v2-cutover.md).

## History and license

The original VPS facilitator is preserved at
[`v1-final`](https://github.com/MorganOnCode/cardano402/tree/v1-final), with its
notes in `docs/v1`. The Preview demo benchmark is recorded in
[docs/portfolio-costs.md](docs/portfolio-costs.md). Apache-2.0.
