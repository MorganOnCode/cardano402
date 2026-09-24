# cardano402

An open-source portfolio project exploring HTTP payments on Cardano using the
x402 Foundation's `@x402/cardano` reference implementation.

The v2 site preserves the exact original landing-page design, including its
Normal/Dev modes, typography, illustrations and demo panel. It is served as
static assets, with no background API polling. An optional live demo uses the project's
own **Cardano Preview** wallet to send 2 test ADA to itself, pay the network fee,
and return a transaction explorer link. Visitors need no wallet or funds.

## Architecture

- `apps/facilitator/landing`: original v1 React page source and artwork.
- `apps/facilitator/public`: built page served by Workers Static Assets.
- `apps/facilitator/src`: keyless x402 verification and settlement inside a
  `PaymentExecutor` Durable Object, plus durable duplicate protection; `/info` is the agent-readable view.
- `apps/demo-worker`: private signing service and single Durable Object for the
  dedicated Preview test wallet. Five new runs/day, ten-minute cooldown,
  bounded retries, durable pending-payment protection. No public routes.
- `packages/`: preserved legacy `@cardano402/*` SDKs, superseded by `@x402/*`.

The preview live demo is enabled after a confirmed on-chain benchmark.
Production live-demo flags remain **disabled**. The current production VPS is unchanged and still serves mainnet until
its dependants have migrated. This branch's future deployment is testnet-only;
it is not a drop-in mainnet replacement for agent-to-agent.

## Develop and check

```sh
pnpm install --frozen-lockfile
pnpm --filter @cardano402/facilitator dev
pnpm --filter @cardano402/facilitator --filter @cardano402/demo-worker typecheck
pnpm --filter @cardano402/facilitator --filter @cardano402/demo-worker test
pnpm --filter @cardano402/facilitator --filter @cardano402/demo-worker build
```

Tests run in workerd with synthetic data and blocked external provider traffic.
The build is a dry-run deploy requiring no credentials. For interactive local
integration, run Wrangler with both apps' config paths; never load mainnet
signing material into the demo.

## API

| Route | Purpose |
|---|---|
| `/` | Original landing page |
| `POST /demo/run` | Start/resume the bounded project-funded Preview demo |
| `/info`, `/SKILL.md`, `/llms.txt` | Agent integration information |
| `/supported` | Reference SDK capabilities on Preview |
| `POST /verify`, `POST /settle` | Capped Preview-only x402 facilitator API |
| `/health` | Shallow health; explicit `?deep=1` is capped at four probes/day |

## Deployment and cost

Use the GitHub deployment workflow. Both preview and production environments
use Cardano Preview, with a separate signing service in each. The production
job remains behind environment approval. No paid account upgrade is automatic.

See [cost controls and benchmark checklist](docs/portfolio-costs.md) and the
[cutover runbook](docs/v2-cutover.md). Hosting targets the free tier but actual
verification CPU must be measured before enabling the live demo.

## History and license

The original VPS facilitator is preserved at
[`v1-final`](https://github.com/MorganOnCode/cardano402/tree/v1-final), with its
notes in `docs/v1`. Apache-2.0.
